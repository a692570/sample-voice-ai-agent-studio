"""
Pre Stack — Shared Infrastructure

Creates:
  - Cognito User Pool and Identity Pool for authentication
  - Cognito User Pool Groups (admin, user) for role-based access
  - Federate (Midway) OIDC identity provider for Amazon internal SSO
  - Cognito Domain for OAuth2 hosted UI flows
  - S3 bucket for assets
  - ECR repository for agent container
"""

from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    aws_cognito as cognito,
    aws_iam as iam,
    aws_s3 as s3,
    aws_ecr as ecr,
)
from constructs import Construct


class PreStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        # Extract SSO config from kwargs before passing to super
        federate_client_id = kwargs.pop("federate_client_id", "")
        federate_client_secret = kwargs.pop("federate_client_secret", "")
        cognito_domain_prefix = kwargs.pop("cognito_domain_prefix", "voice-agent-poc")
        app_callback_urls = kwargs.pop("app_callback_urls", ["http://localhost:5173/callback"])
        app_logout_urls = kwargs.pop("app_logout_urls", ["http://localhost:5173/"])

        super().__init__(scope, construct_id, **kwargs)

        # Cognito User Pool
        self.user_pool = cognito.UserPool(
            self,
            "VoiceAgentUserPoolV2",
            user_pool_name="voice-agent-poc-user-pool-v2",
            self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(email=True, username=True),
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_uppercase=True,
                require_lowercase=True,
                require_digits=True,
                require_symbols=True,  # AwsSolutions-COG1: full complexity
            ),
            user_invitation=cognito.UserInvitationConfig(
                email_subject="Voice AI POC-in-a-Box — Your Login Credentials",
                email_body=(
                    "<h2>Voice AI POC-in-a-Box</h2>"
                    "<p>You've been invited to the Voice AI POC-in-a-Box demo tool.</p>"
                    "<p>This is a voice agent configuration and testing platform powered by "
                    "Amazon Bedrock AgentCore and Nova 2 Sonic.</p>"
                    "<h3>Your temporary credentials:</h3>"
                    "<p><strong>Username:</strong> {username}<br/>"
                    "<strong>Password:</strong> {####}</p>"
                    "<p>You will be asked to set a new password on first login.</p>"
                    "<p>Your administrator will share the sign-in URL separately "
                    "(it is printed at the end of the deployment). Open that URL and "
                    "log in with the username and temporary password above.</p>"
                ),
            ),
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Cognito Groups for role-based access control
        # Admin group: can see and manage all users' data
        self.admin_group = cognito.CfnUserPoolGroup(
            self,
            "AdminGroup",
            user_pool_id=self.user_pool.user_pool_id,
            group_name="admin",
            description="Administrators with access to all users' data",
            precedence=0,
        )

        # User group: can only see and manage their own data
        self.user_group = cognito.CfnUserPoolGroup(
            self,
            "UserGroup",
            user_pool_id=self.user_pool.user_pool_id,
            group_name="user",
            description="Regular users with access to their own data only",
            precedence=10,
        )

        # Federate (Midway) OIDC Identity Provider
        self.federate_provider = None
        supported_providers = [
            cognito.UserPoolClientIdentityProvider.COGNITO,
        ]

        if federate_client_id and federate_client_secret:
            self.federate_provider = cognito.UserPoolIdentityProviderOidc(
                self,
                "FederateOIDC",
                user_pool=self.user_pool,
                name="FederateOIDC",
                client_id=federate_client_id,
                client_secret=federate_client_secret,
                issuer_url="https://idp.federate.amazon.com",
                scopes=["openid"],
                attribute_request_method=cognito.OidcAttributeRequestMethod.GET,
                attribute_mapping=cognito.AttributeMapping(
                    email=cognito.ProviderAttribute.other("EMAIL"),
                    given_name=cognito.ProviderAttribute.other("GIVEN_NAME"),
                    family_name=cognito.ProviderAttribute.other("FAMILY_NAME"),
                ),
            )
            supported_providers.append(
                cognito.UserPoolClientIdentityProvider.custom("FederateOIDC")
            )

        # Cognito Domain (required for OAuth2/OIDC flows).
        # Domain prefixes are GLOBALLY unique across all AWS accounts, so unless
        # the caller supplied an explicit prefix we suffix it with the account ID
        # to avoid collisions with other deployments (same pattern as the S3 bucket).
        if cognito_domain_prefix == "voice-agent-poc":
            cognito_domain_prefix = f"voice-agent-poc-{self.account}"
        self.user_pool_domain = self.user_pool.add_domain(
            "VoiceAgentCognitoDomain",
            cognito_domain=cognito.CognitoDomainOptions(
                domain_prefix=cognito_domain_prefix,
            ),
        )

        # User Pool Client — supports both Cognito native + Federate
        self.user_pool_client = self.user_pool.add_client(
            "VoiceAgentWebClient",
            user_pool_client_name="voice-agent-web-client",
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True,
            ),
            supported_identity_providers=supported_providers,
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.PROFILE,
                ],
                callback_urls=app_callback_urls,
                logout_urls=app_logout_urls,
            ),
        )

        # Ensure app client is created after Federate provider
        if self.federate_provider:
            self.user_pool_client.node.add_dependency(self.federate_provider)

        # Identity Pool
        self.identity_pool = cognito.CfnIdentityPool(
            self,
            "VoiceAgentIdentityPool",
            identity_pool_name="voice_agent_poc_identity_pool",
            allow_unauthenticated_identities=False,
            cognito_identity_providers=[
                cognito.CfnIdentityPool.CognitoIdentityProviderProperty(
                    client_id=self.user_pool_client.user_pool_client_id,
                    provider_name=self.user_pool.user_pool_provider_name,
                )
            ],
        )

        # Authenticated role for Identity Pool
        self.authenticated_role = iam.Role(
            self,
            "CognitoAuthenticatedRole",
            assumed_by=iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                conditions={
                    "StringEquals": {
                        "cognito-identity.amazonaws.com:aud": self.identity_pool.ref
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated"
                    },
                },
                assume_role_action="sts:AssumeRoleWithWebIdentity",
            ),
        )

        # Grant the authenticated role permission to invoke AgentCore
        self.authenticated_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock-agentcore:InvokeAgentRuntime",
                    "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
                    "bedrock-agentcore:*",
                ],
                resources=["*"],
            )
        )

        # Attach roles to Identity Pool
        cognito.CfnIdentityPoolRoleAttachment(
            self,
            "IdentityPoolRoleAttachment",
            identity_pool_id=self.identity_pool.ref,
            roles={
                "authenticated": self.authenticated_role.role_arn,
            },
        )

        # S3 Bucket for assets
        # Access-log bucket for S3 server access logs (cdk-nag AwsSolutions-S1).
        self.access_logs_bucket = s3.Bucket(
            self,
            "AccessLogsBucket",
            bucket_name=f"voice-agent-poc-logs-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
        )

        self.assets_bucket = s3.Bucket(
            self,
            "VoiceAgentAssets",
            bucket_name=f"voice-agent-poc-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,                       # AwsSolutions-S10: require TLS
            encryption=s3.BucketEncryption.S3_MANAGED,
            server_access_logs_bucket=self.access_logs_bucket,  # AwsSolutions-S1
            server_access_logs_prefix="assets/",
        )

        # ECR Repository for agent container
        self.ecr_repo = ecr.Repository(
            self,
            "VoiceAgentEcr",
            repository_name="voice-agent-poc",
            removal_policy=RemovalPolicy.DESTROY,
            empty_on_delete=True,
        )

        # Outputs
        CfnOutput(self, "UserPoolId", value=self.user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=self.user_pool_client.user_pool_client_id)
        CfnOutput(self, "IdentityPoolId", value=self.identity_pool.ref)
        CfnOutput(
            self,
            "CognitoDomain",
            value=f"{cognito_domain_prefix}.auth.{self.region}.amazoncognito.com",
            description="Cognito OAuth2 domain for SSO flows",
        )
        CfnOutput(
            self,
            "FederateEnabled",
            value="true" if self.federate_provider else "false",
            description="Whether Federate (Midway) SSO is configured",
        )
        CfnOutput(self, "AssetsBucket", value=self.assets_bucket.bucket_name)
        CfnOutput(self, "EcrRepository", value=self.ecr_repo.repository_uri)
