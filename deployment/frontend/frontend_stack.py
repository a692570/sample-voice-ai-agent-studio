"""
Frontend Stack — React UI Deployment

Creates:
  - S3 bucket for hosting the built React app
  - CloudFront distribution for global delivery
  - Origin Access Control for secure S3 access
"""

from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    Size,
    aws_s3 as s3,
    aws_s3_deployment as s3_deploy,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
)
from constructs import Construct
import os


class FrontendStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, pre_stack, agent_stack, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        # Access-log bucket for S3 + CloudFront logs (AwsSolutions-S1 / CFR3).
        # CloudFront requires the log bucket to have ACLs enabled (bucket-owner).
        self.logs_bucket = s3.Bucket(
            self,
            "FrontendLogsBucket",
            bucket_name=f"voice-agent-poc-web-logs-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
        )

        # S3 bucket for frontend static files
        self.website_bucket = s3.Bucket(
            self,
            "WebsiteBucket",
            bucket_name=f"voice-agent-poc-web-{self.account}-{self.region}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,                                    # AwsSolutions-S10
            encryption=s3.BucketEncryption.S3_MANAGED,
            server_access_logs_bucket=self.logs_bucket,          # AwsSolutions-S1
            server_access_logs_prefix="website/",
        )

        # CloudFront distribution
        self.distribution = cloudfront.Distribution(
            self,
            "WebDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(
                    self.website_bucket
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            ),
            default_root_object="index.html",
            # AwsSolutions-CFR3: access logging; CFR4: enforce TLS 1.2 minimum.
            enable_logging=True,
            log_bucket=self.logs_bucket,
            log_file_prefix="cloudfront/",
            minimum_protocol_version=cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                ),
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                ),
            ],
        )

        # Deploy built frontend to S3
        # NOTE: Run `npm run build` in source/frontend before deploying
        frontend_dist_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "source", "frontend", "dist"
        )

        if os.path.exists(frontend_dist_path):
            s3_deploy.BucketDeployment(
                self,
                "DeployWebsite",
                sources=[s3_deploy.Source.asset(frontend_dist_path)],
                destination_bucket=self.website_bucket,
                distribution=self.distribution,
                distribution_paths=["/*"],
                memory_limit=512,
                ephemeral_storage_size=Size.mebibytes(1024),
            )

        # Outputs
        CfnOutput(
            self,
            "WebsiteUrl",
            value=f"https://{self.distribution.distribution_domain_name}",
            description="Voice Agent POC website URL",
        )
        CfnOutput(self, "DistributionId", value=self.distribution.distribution_id)
        CfnOutput(self, "WebsiteBucketName", value=self.website_bucket.bucket_name)
