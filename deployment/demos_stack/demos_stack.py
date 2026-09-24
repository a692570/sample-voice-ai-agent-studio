"""
Demos Stack — Demo Management API

Creates:
  - DynamoDB tables for storing demo configurations (with userId GSI for multi-tenancy)
  - Lambda functions for CRUD operations
  - API Gateway REST API with Cognito Authorizer
"""

import os

from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    Duration,
    Size,
    aws_dynamodb as dynamodb,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_iam as iam,
    aws_s3 as s3,
    aws_logs as logs,
)
from constructs import Construct


class DemosStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, agent_stack=None, pre_stack=None, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        self.pre_stack = pre_stack

        # Shared S3 access-log bucket for this stack's buckets (AwsSolutions-S1).
        self.access_logs_bucket = s3.Bucket(
            self,
            "DemosAccessLogsBucket",
            bucket_name=f"voice-agent-poc-demos-logs-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
        )

        # AgentCore Runtime ARN (from agent stack, if provided)
        self.agentcore_runtime_arn = ""
        if agent_stack and hasattr(agent_stack, "runtime"):
            self.agentcore_runtime_arn = agent_stack.runtime.agent_runtime_arn

        # --- Cognito Authorizer for API Gateway ---
        self.authorizer = None
        if pre_stack and hasattr(pre_stack, "user_pool"):
            self.authorizer = apigw.CognitoUserPoolsAuthorizer(
                self,
                "CognitoAuthorizer",
                cognito_user_pools=[pre_stack.user_pool],
                authorizer_name="voice-agent-cognito-authorizer",
            )

        # DynamoDB Table with userId GSI for multi-tenancy
        self.table = dynamodb.Table(
            self,
            "DemosTable",
            table_name="voice-agent-poc-demos",
            partition_key=dynamodb.Attribute(
                name="id", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # GSI for querying demos by userId
        self.table.add_global_secondary_index(
            index_name="userId-index",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="updatedAt", type=dynamodb.AttributeType.STRING
            ),
        )

        # Lambda Function
        self.handler = _lambda.Function(
            self,
            "DemosHandler",
            function_name="voice-agent-poc-demos-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="demos_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "TABLE_NAME": self.table.table_name,
            },
        )

        # Grant Lambda read/write access to the table
        self.table.grant_read_write_data(self.handler)

        # Access-log group for the API stage (AwsSolutions-APIG1).
        self.api_access_log_group = logs.LogGroup(
            self,
            "DemosApiAccessLogs",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # API Gateway REST API
        self.api = apigw.RestApi(
            self,
            "DemosApi",
            rest_api_name="voice-agent-poc-demos-api",
            description="CRUD API for voice agent demo configurations",
            # cdk-nag: enable request validation (APIG2), access logging (APIG1)
            # and per-method CloudWatch logging + metrics (APIG6) on the stage.
            deploy_options=apigw.StageOptions(
                access_log_destination=apigw.LogGroupLogDestination(self.api_access_log_group),
                access_log_format=apigw.AccessLogFormat.json_with_standard_fields(
                    caller=True, http_method=True, ip=True, protocol=True,
                    request_time=True, resource_path=True, response_length=True,
                    status=True, user=True,
                ),
                logging_level=apigw.MethodLoggingLevel.INFO,
                metrics_enabled=True,
            ),
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=[
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Api-Key",
                ],
            ),
        )

        # AwsSolutions-APIG2: enable basic request validation on the REST API.
        self.api.add_request_validator(
            "DemosApiRequestValidator",
            validate_request_body=True,
            validate_request_parameters=True,
        )

        # Add CORS headers to Gateway error responses (401/403 from Cognito authorizer)
        # Without this, browsers block auth errors due to missing Access-Control-Allow-Origin
        self.api.add_gateway_response(
            "Unauthorized",
            type=apigw.ResponseType.UNAUTHORIZED,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key'",
            },
        )
        self.api.add_gateway_response(
            "AccessDenied",
            type=apigw.ResponseType.ACCESS_DENIED,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key'",
            },
        )
        self.api.add_gateway_response(
            "Default4XX",
            type=apigw.ResponseType.DEFAULT_4_XX,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key'",
                "Access-Control-Allow-Methods": "'GET,POST,PUT,DELETE,OPTIONS'",
            },
        )

        # Lambda integration
        integration = apigw.LambdaIntegration(self.handler)

        # Method options with Cognito auth
        auth_options = {}
        if self.authorizer:
            auth_options = {
                "authorization_type": apigw.AuthorizationType.COGNITO,
                "authorizer": self.authorizer,
            }

        # /demos resource
        demos_resource = self.api.root.add_resource("demos")
        demos_resource.add_method("GET", integration, **auth_options)   # List all
        demos_resource.add_method("POST", integration, **auth_options)  # Create

        # /demos/{id} resource
        demo_by_id = demos_resource.add_resource("{id}")
        demo_by_id.add_method("GET", integration, **auth_options)     # Get one
        demo_by_id.add_method("PUT", integration, **auth_options)     # Update
        demo_by_id.add_method("DELETE", integration, **auth_options)  # Delete

        # --- Generate Agent Lambda (Bedrock) ---
        self.generate_handler = _lambda.Function(
            self,
            "GenerateAgentHandler",
            function_name="voice-agent-poc-generate-agent",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="generate_agent_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(60),
            memory_size=256,
            environment={
                "BEDROCK_MODEL_ID": "anthropic.claude-3-sonnet-20240229-v1:0",
                "BEDROCK_REGION": self.region,
            },
        )

        # Grant Bedrock invoke permissions
        self.generate_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=["*"],
            )
        )

        generate_integration = apigw.LambdaIntegration(self.generate_handler)

        # /generate-agent resource
        generate_resource = self.api.root.add_resource("generate-agent")
        generate_resource.add_method("POST", generate_integration, **auth_options)

        # --- Generate Prompt Lambda (Bedrock) ---
        self.generate_prompt_handler = _lambda.Function(
            self,
            "GeneratePromptHandler",
            function_name="voice-agent-poc-generate-prompt",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="generate_prompt_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(60),
            memory_size=256,
            environment={
                "BEDROCK_MODEL_ID": "anthropic.claude-3-sonnet-20240229-v1:0",
                "BEDROCK_REGION": self.region,
            },
        )

        # Grant Bedrock invoke permissions
        self.generate_prompt_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=["*"],
            )
        )

        generate_prompt_integration = apigw.LambdaIntegration(self.generate_prompt_handler)

        # /generate-prompt resource
        generate_prompt_resource = self.api.root.add_resource("generate-prompt")
        generate_prompt_resource.add_method("POST", generate_prompt_integration, **auth_options)

        # --- RAG Handler Lambda ---
        # RAG S3 bucket for documents
        self.rag_bucket = s3.Bucket(
            self,
            "RAGDocsBucket",
            bucket_name=f"voice-agent-poc-kb-docs-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                )
            ],
        )

        # App config table — holds the RAG Knowledge Base id set from the UI.
        # The KB id is not a secret; it's a Bedrock KB identifier the user creates
        # in their account and pastes into the UI. A single item keys the config.
        self.app_config_table = dynamodb.Table(
            self,
            "AppConfigTable",
            table_name="voice-agent-poc-config",
            partition_key=dynamodb.Attribute(
                name="configKey", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        self.rag_handler = _lambda.Function(
            self,
            "RAGHandler",
            function_name="voice-agent-poc-rag-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="rag_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(60),
            memory_size=512,
            environment={
                "DOCS_BUCKET": self.rag_bucket.bucket_name,
                "CONFIG_TABLE_NAME": self.app_config_table.table_name,
                # The Bedrock Knowledge Base is NOT created by this app — it is an
                # existing KB in the target account. Set its id per-account at deploy
                # time via CDK context (`-c kb_id=XXXX`) or the KB_ID env var. Defaults
                # to empty, in which case the RAG page shows "not configured" instead
                # of erroring.
                "KB_ID": self.node.try_get_context("kb_id") or os.environ.get("KB_ID", ""),
                "KB_ROLE_ARN": f"arn:aws:iam::{self.account}:role/voice-agent-poc-kb-role-{self.region}",
                "AWS_ACCOUNT_ID": self.account,
            },
        )

        # RAG permissions
        self.rag_bucket.grant_read_write(self.rag_handler)
        self.app_config_table.grant_read_write_data(self.rag_handler)

        self.rag_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["iam:PassRole"],
                resources=[f"arn:aws:iam::{self.account}:role/voice-agent-poc-kb-role-{self.region}"],
            )
        )

        # Grant the KB role access to the docs bucket (needed for S3 data source ingestion).
        # Import the role as immutable (mutable=False): the KB role is created by a
        # separate stack, so DemosStack must NOT try to attach policies to it (that would
        # require the role to already exist and fail on a fresh account). Read access for
        # the KB role to this bucket is handled where the role itself is defined.
        self.rag_bucket.grant_read(
            iam.Role.from_role_arn(
                self,
                "ImportedKBRole",
                f"arn:aws:iam::{self.account}:role/voice-agent-poc-kb-role-{self.region}",
                mutable=False,
            )
        )
        self.rag_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:*"],
                resources=["*"],
            )
        )

        rag_integration = apigw.LambdaIntegration(self.rag_handler)

        # /rag resource
        rag_resource = self.api.root.add_resource("rag")
        rag_resource.add_method("GET", rag_integration, **auth_options)
        rag_resource.add_method("POST", rag_integration, **auth_options)

        # /rag/config — get/set the Knowledge Base id (static resource, added
        # before {id} so it is matched as a literal path segment)
        rag_config = rag_resource.add_resource("config")
        rag_config.add_method("GET", rag_integration, **auth_options)
        rag_config.add_method("PUT", rag_integration, **auth_options)

        # /rag/knowledge-bases — list Bedrock KBs in the account for selection
        rag_kbs = rag_resource.add_resource("knowledge-bases")
        rag_kbs.add_method("GET", rag_integration, **auth_options)

        # /rag/{id}
        rag_by_id = rag_resource.add_resource("{id}")
        rag_by_id.add_method("GET", rag_integration, **auth_options)
        rag_by_id.add_method("DELETE", rag_integration, **auth_options)

        # /rag/{id}/upload
        rag_upload = rag_by_id.add_resource("upload")
        rag_upload.add_method("POST", rag_integration, **auth_options)

        # /rag/{id}/files
        rag_files = rag_by_id.add_resource("files")
        rag_files.add_method("GET", rag_integration, **auth_options)

        # /rag/{id}/sync
        rag_sync = rag_by_id.add_resource("sync")
        rag_sync.add_method("POST", rag_integration, **auth_options)

        # /rag/{id}/query
        rag_query = rag_by_id.add_resource("query")
        rag_query.add_method("POST", rag_integration, **auth_options)

        # --- Tools Handler Lambda ---
        self.tools_table = dynamodb.Table(
            self,
            "ToolsTable",
            table_name="voice-agent-poc-tools",
            partition_key=dynamodb.Attribute(
                name="id", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # GSI for querying tools by userId
        self.tools_table.add_global_secondary_index(
            index_name="userId-index",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="createdAt", type=dynamodb.AttributeType.STRING
            ),
        )

        self.tools_handler = _lambda.Function(
            self,
            "ToolsHandler",
            function_name="voice-agent-poc-tools-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="tools_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "TOOLS_TABLE_NAME": self.tools_table.table_name,
            },
        )

        self.tools_table.grant_read_write_data(self.tools_handler)

        self.tools_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "lambda:ListFunctions",
                    "lambda:InvokeFunction",
                    "bedrock-agentcore:*",
                    "bedrock-agentcore-control:*",
                    "cognito-idp:DescribeUserPoolClient",
                ],
                resources=["*"],
            )
        )

        tools_integration = apigw.LambdaIntegration(self.tools_handler)

        # /tools resource
        tools_resource = self.api.root.add_resource("tools")
        tools_resource.add_method("GET", tools_integration, **auth_options)
        tools_resource.add_method("POST", tools_integration, **auth_options)

        # /tools/{id}
        tools_by_id = tools_resource.add_resource("{id}")
        tools_by_id.add_method("DELETE", tools_integration, **auth_options)
        tools_by_id.add_method("PUT", tools_integration, **auth_options)

        # /tools/{id}/test
        tools_test = tools_by_id.add_resource("test")
        tools_test.add_method("POST", tools_integration, **auth_options)

        # /tools/lambdas
        tools_lambdas = tools_resource.add_resource("lambdas")
        tools_lambdas.add_method("GET", tools_integration, **auth_options)

        # /tools/gateways
        tools_gateways = tools_resource.add_resource("gateways")
        tools_gateways.add_method("GET", tools_integration, **auth_options)

        # /tools/gateways/{id}
        tools_gateway_by_id = tools_gateways.add_resource("{gatewayId}")
        tools_gateway_by_id.add_method("GET", tools_integration, **auth_options)

        # /tools/gateways/{id}/call
        tools_gateway_call = tools_gateway_by_id.add_resource("call")
        tools_gateway_call.add_method("POST", tools_integration, **auth_options)

        # /tools/runtimes
        tools_runtimes = tools_resource.add_resource("runtimes")
        tools_runtimes.add_method("GET", tools_integration, **auth_options)

        # --- Phone Mappings Handler Lambda ---
        # Maps a phone number -> agent/demo. Populated via the UI after the user
        # deploys PSTN/SIP separately. The telephony components (deployed manually,
        # outside this CDK app) read this table to route incoming calls.
        self.phone_mappings_table = dynamodb.Table(
            self,
            "PhoneMappingsTable",
            table_name="voice-agent-poc-phone-mappings",
            partition_key=dynamodb.Attribute(
                name="phoneNumber", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        self.phone_mappings_handler = _lambda.Function(
            self,
            "PhoneMappingsHandler",
            function_name="voice-agent-poc-phone-mappings-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="phone_mappings_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "TABLE_NAME": self.phone_mappings_table.table_name,
                # Secret names holding the telephony bridge config (set up by the
                # telephony/{pstn,sip}/configure.sh scripts). Used only to report
                # whether each provider is configured — values are never read here.
                "PSTN_CONFIG_SECRET_NAME": "voice-agent-poc/pstn",
                "SIP_CONFIG_SECRET_NAME": "voice-agent-poc/sip",
            },
        )

        self.phone_mappings_table.grant_read_write_data(self.phone_mappings_handler)

        # Allow the handler to check whether the telephony config secrets exist
        # (DescribeSecret only — no GetSecretValue, so it can never read values).
        self.phone_mappings_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["secretsmanager:DescribeSecret"],
                resources=[
                    f"arn:aws:secretsmanager:{self.region}:{self.account}:secret:voice-agent-poc/pstn-*",
                    f"arn:aws:secretsmanager:{self.region}:{self.account}:secret:voice-agent-poc/sip-*",
                ],
            )
        )

        phone_mappings_integration = apigw.LambdaIntegration(self.phone_mappings_handler)

        # /phone-mappings
        phone_mappings_resource = self.api.root.add_resource("phone-mappings")
        phone_mappings_resource.add_method("GET", phone_mappings_integration, **auth_options)

        # /phone-mappings/status — reports {pstn: bool, sip: bool} config state
        phone_mappings_status = phone_mappings_resource.add_resource("status")
        phone_mappings_status.add_method("GET", phone_mappings_integration, **auth_options)

        # /phone-mappings/{phone}
        phone_mappings_by_phone = phone_mappings_resource.add_resource("{phone}")
        phone_mappings_by_phone.add_method("GET", phone_mappings_integration, **auth_options)
        phone_mappings_by_phone.add_method("PUT", phone_mappings_integration, **auth_options)
        phone_mappings_by_phone.add_method("DELETE", phone_mappings_integration, **auth_options)

        # --- Sample Weather Tool Lambda (for testing Lambda tool integration) ---
        self.weather_tool = _lambda.Function(
            self,
            "WeatherToolLambda",
            function_name="voice-agent-poc-weather-tool",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="weather_tool.handler",
            code=_lambda.Code.from_asset("../source/api/sample_tools"),
            timeout=Duration.seconds(15),
            memory_size=128,
            description="Sample tool: queries wttr.in for current weather by location",
        )

        # --- Skills Handler Lambda ---
        self.skills_table = dynamodb.Table(
            self,
            "SkillsTable",
            table_name="voice-agent-poc-skills",
            partition_key=dynamodb.Attribute(
                name="id", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # GSI for querying skills by userId
        self.skills_table.add_global_secondary_index(
            index_name="userId-index",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="createdAt", type=dynamodb.AttributeType.STRING
            ),
        )

        self.skills_handler = _lambda.Function(
            self,
            "SkillsHandler",
            function_name="voice-agent-poc-skills-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="skills_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "SKILLS_TABLE_NAME": self.skills_table.table_name,
                "SKILLS_BUCKET": self.rag_bucket.bucket_name,
            },
        )

        self.skills_table.grant_read_write_data(self.skills_handler)
        self.rag_bucket.grant_read_write(self.skills_handler)

        skills_integration = apigw.LambdaIntegration(self.skills_handler)

        # /skills resource
        skills_resource = self.api.root.add_resource("skills")
        skills_resource.add_method("GET", skills_integration, **auth_options)
        skills_resource.add_method("POST", skills_integration, **auth_options)

        # /skills/upload
        skills_upload = skills_resource.add_resource("upload")
        skills_upload.add_method("POST", skills_integration, **auth_options)

        # /skills/{id}
        skills_by_id = skills_resource.add_resource("{id}")
        skills_by_id.add_method("DELETE", skills_integration, **auth_options)

        # --- Eval Harness ---
        # DynamoDB table for eval jobs
        self.eval_table = dynamodb.Table(
            self,
            "EvalJobsTable",
            table_name="voice-agent-poc-eval-jobs",
            partition_key=dynamodb.Attribute(
                name="id", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # GSI for querying eval jobs by userId
        self.eval_table.add_global_secondary_index(
            index_name="userId-index",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="createdAt", type=dynamodb.AttributeType.STRING
            ),
        )

        # S3 bucket for eval results
        self.eval_results_bucket = s3.Bucket(
            self,
            "EvalResultsBucket",
            bucket_name=f"voice-agent-poc-eval-results-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # --- Call History ---
        self.call_history_bucket = s3.Bucket(
            self,
            "CallHistoryBucket",
            bucket_name=f"voice-agent-poc-call-history-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            lifecycle_rules=[s3.LifecycleRule(expiration=Duration.days(90))],
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.GET],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                )
            ],
        )

        self.call_history_table = dynamodb.Table(
            self,
            "CallHistoryTable",
            table_name="voice-agent-poc-call-history",
            partition_key=dynamodb.Attribute(
                name="agentId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="startedAt", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Eval Runner Lambda (runs eval harness — bundled with dependencies)
        # Pre-bundle with: source/eval-runner/bundle.sh (installs deps + copies harness)
        self.eval_runner = _lambda.Function(
            self,
            "EvalRunnerLambda",
            function_name="voice-agent-poc-eval-runner",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="eval_runner.handler",
            code=_lambda.Code.from_asset("../source/eval-runner/bundled"),
            timeout=Duration.minutes(15),
            memory_size=2048,
            ephemeral_storage_size=Size.mebibytes(1024),
            environment={
                "EVAL_TABLE_NAME": self.eval_table.table_name,
                "DEMOS_TABLE_NAME": self.table.table_name,
                "TOOLS_TABLE_NAME": self.tools_table.table_name,
                "EVAL_RESULTS_BUCKET": self.eval_results_bucket.bucket_name,
                "AGENTCORE_RUNTIME_ARN": self.agentcore_runtime_arn,
            },
            reserved_concurrent_executions=10,
        )

        # Grant Runner permissions
        self.eval_table.grant_read_write_data(self.eval_runner)
        self.table.grant_read_data(self.eval_runner)
        self.tools_table.grant_read_data(self.eval_runner)
        self.eval_results_bucket.grant_read_write(self.eval_runner)
        self.eval_runner.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:InvokeModelWithBidirectionalStream",
                    "bedrock-agentcore:InvokeAgentRuntime",
                    "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
                    "bedrock-agentcore:*",
                    "polly:SynthesizeSpeech",
                ],
                resources=["*"],
            )
        )

        # Eval API Lambda (thin orchestrator)
        self.eval_handler = _lambda.Function(
            self,
            "EvalHandler",
            function_name="voice-agent-poc-eval-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="eval_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "EVAL_TABLE_NAME": self.eval_table.table_name,
                "DEMOS_TABLE_NAME": self.table.table_name,
                "TOOLS_TABLE_NAME": self.tools_table.table_name,
                "EVAL_RESULTS_BUCKET": self.eval_results_bucket.bucket_name,
                "EVAL_RUNNER_FUNCTION_NAME": self.eval_runner.function_name,
            },
        )

        # Grant Eval API permissions
        self.eval_table.grant_read_write_data(self.eval_handler)
        self.table.grant_read_data(self.eval_handler)
        self.tools_table.grant_read_data(self.eval_handler)
        self.eval_results_bucket.grant_read(self.eval_handler)
        self.eval_runner.grant_invoke(self.eval_handler)
        self.eval_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=["*"],
            )
        )

        eval_integration = apigw.LambdaIntegration(self.eval_handler)

        # /eval resource
        eval_resource = self.api.root.add_resource("eval")

        # /eval/jobs
        eval_jobs = eval_resource.add_resource("jobs")
        eval_jobs.add_method("GET", eval_integration, **auth_options)
        eval_jobs.add_method("POST", eval_integration, **auth_options)

        # /eval/jobs/{id}
        eval_job_by_id = eval_jobs.add_resource("{id}")
        eval_job_by_id.add_method("GET", eval_integration, **auth_options)
        eval_job_by_id.add_method("DELETE", eval_integration, **auth_options)
        eval_job_by_id.add_method("PATCH", eval_integration, **auth_options)

        # /eval/jobs/{id}/results
        eval_job_results = eval_job_by_id.add_resource("results")
        eval_job_results.add_method("GET", eval_integration, **auth_options)

        # /eval/jobs/{id}/delete
        eval_job_delete = eval_job_by_id.add_resource("delete")
        eval_job_delete.add_method("DELETE", eval_integration, **auth_options)

        # /eval/batches
        eval_batches = eval_resource.add_resource("batches")
        eval_batches.add_method("POST", eval_integration, **auth_options)

        # /eval/batches/{id}
        eval_batch_by_id = eval_batches.add_resource("{id}")
        eval_batch_by_id.add_method("GET", eval_integration, **auth_options)

        # /eval/suggest-prompt
        eval_suggest = eval_resource.add_resource("suggest-prompt")
        eval_suggest.add_method("POST", eval_integration, **auth_options)

        # Outputs
        CfnOutput(self, "DemosApiUrl", value=self.api.url)
        CfnOutput(self, "DemosTableName", value=self.table.table_name)
        CfnOutput(self, "PhoneMappingsTableName", value=self.phone_mappings_table.table_name)
        CfnOutput(self, "WeatherToolArn", value=self.weather_tool.function_arn)
        CfnOutput(self, "EvalTableName", value=self.eval_table.table_name)
        CfnOutput(self, "EvalResultsBucketName", value=self.eval_results_bucket.bucket_name)

        # --- Eval Suites ---
        self.eval_suites_table = dynamodb.Table(
            self,
            "EvalSuitesTable",
            table_name="voice-agent-eval-suites",
            partition_key=dynamodb.Attribute(
                name="id", type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        self.eval_suites_table.add_global_secondary_index(
            index_name="userId-index",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="createdAt", type=dynamodb.AttributeType.STRING
            ),
        )

        self.eval_suites_handler = _lambda.Function(
            self,
            "EvalSuitesHandler",
            function_name="voice-agent-poc-eval-suites-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="eval_suites_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "EVAL_SUITES_TABLE_NAME": self.eval_suites_table.table_name,
                "EVAL_TABLE_NAME": self.eval_table.table_name,
            },
        )

        self.eval_suites_table.grant_read_write_data(self.eval_suites_handler)
        self.eval_table.grant_read_data(self.eval_suites_handler)

        eval_suites_integration = apigw.LambdaIntegration(self.eval_suites_handler)

        # /eval-suites
        eval_suites_resource = self.api.root.add_resource("eval-suites")
        eval_suites_resource.add_method("GET", eval_suites_integration, **auth_options)
        eval_suites_resource.add_method("POST", eval_suites_integration, **auth_options)

        # /eval-suites/{id}
        eval_suite_by_id = eval_suites_resource.add_resource("{id}")
        eval_suite_by_id.add_method("GET", eval_suites_integration, **auth_options)
        eval_suite_by_id.add_method("PUT", eval_suites_integration, **auth_options)
        eval_suite_by_id.add_method("DELETE", eval_suites_integration, **auth_options)

        # /eval-suites/{id}/test-cases
        eval_suite_test_cases = eval_suite_by_id.add_resource("test-cases")
        eval_suite_test_cases.add_method("POST", eval_suites_integration, **auth_options)

        # /eval-suites/{id}/test-cases/{tcId}
        eval_suite_tc_by_id = eval_suite_test_cases.add_resource("{tcId}")
        eval_suite_tc_by_id.add_method("PUT", eval_suites_integration, **auth_options)
        eval_suite_tc_by_id.add_method("DELETE", eval_suites_integration, **auth_options)

        # /eval-suites/{id}/runs
        eval_suite_runs = eval_suite_by_id.add_resource("runs")
        eval_suite_runs.add_method("GET", eval_suites_integration, **auth_options)

        # /eval-suites/{id}/test-cases/{tcId}/runs
        eval_suite_tc_runs = eval_suite_tc_by_id.add_resource("runs")
        eval_suite_tc_runs.add_method("GET", eval_suites_integration, **auth_options)

        CfnOutput(self, "EvalSuitesTableName", value=self.eval_suites_table.table_name)

        # --- Call History API ---
        self.call_history_handler = _lambda.Function(
            self,
            "CallHistoryHandler",
            function_name="voice-agent-poc-call-history-handler",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="call_history_handler.handler",
            code=_lambda.Code.from_asset("../source/api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "CALL_HISTORY_TABLE": self.call_history_table.table_name,
                "CALL_HISTORY_BUCKET": self.call_history_bucket.bucket_name,
            },
        )

        self.call_history_table.grant_read_write_data(self.call_history_handler)
        self.call_history_bucket.grant_read_write(self.call_history_handler)
        self.call_history_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=["*"],
            )
        )

        call_history_integration = apigw.LambdaIntegration(self.call_history_handler)

        # /call-history/sessions
        call_history_resource = self.api.root.add_resource("call-history")
        call_history_sessions = call_history_resource.add_resource("sessions")
        call_history_sessions.add_method("GET", call_history_integration, **auth_options)

        # /call-history/sessions/{sessionId}
        call_history_session_by_id = call_history_sessions.add_resource("{sessionId}")
        call_history_session_by_id.add_method("GET", call_history_integration, **auth_options)
        call_history_session_by_id.add_method("DELETE", call_history_integration, **auth_options)

        # /call-history/analyze
        call_history_analyze = call_history_resource.add_resource("analyze")
        call_history_analyze.add_method("POST", call_history_integration, **auth_options)

        CfnOutput(self, "CallHistoryBucketName", value=self.call_history_bucket.bucket_name)
        CfnOutput(self, "CallHistoryTableName", value=self.call_history_table.table_name)

        # --- Security hardening applied uniformly across this stack's data stores.
        # Done here (once) so every DynamoDB table and S3 bucket is covered without
        # repeating props on each construct.
        self._harden_data_stores()

    def _harden_data_stores(self):
        """Enable DynamoDB point-in-time recovery (AwsSolutions-DDB3) on all tables
        and TLS enforcement + server access logging (AwsSolutions-S1/S10) on all
        buckets except the access-log bucket itself. Uses the typed L1 constructs
        so the properties render reliably."""
        for table in self.node.find_all():
            if isinstance(table, dynamodb.Table):
                cfn_table = table.node.default_child  # type: dynamodb.CfnTable
                cfn_table.point_in_time_recovery_specification = (
                    dynamodb.CfnTable.PointInTimeRecoverySpecificationProperty(
                        point_in_time_recovery_enabled=True
                    )
                )
        for bucket in self.node.find_all():
            if isinstance(bucket, s3.Bucket) and bucket is not self.access_logs_bucket:
                bucket.add_to_resource_policy(
                    iam.PolicyStatement(
                        sid="EnforceTLS",
                        effect=iam.Effect.DENY,
                        principals=[iam.AnyPrincipal()],
                        actions=["s3:*"],
                        resources=[bucket.bucket_arn, bucket.arn_for_objects("*")],
                        conditions={"Bool": {"aws:SecureTransport": "false"}},
                    )
                )
                cfn_bucket = bucket.node.default_child  # type: s3.CfnBucket
                cfn_bucket.logging_configuration = s3.CfnBucket.LoggingConfigurationProperty(
                    destination_bucket_name=self.access_logs_bucket.bucket_name,
                    log_file_prefix=f"{bucket.node.id.lower()}/",
                )
