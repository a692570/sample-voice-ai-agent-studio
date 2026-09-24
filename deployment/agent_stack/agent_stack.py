"""
Agent Stack — Voice Agent Runtime on Bedrock AgentCore

Deploys the voice agent to Amazon Bedrock AgentCore Runtime with WebSocket
support for bidirectional audio streaming. Uses the Strands BidiAgent with
Nova 2 Sonic.

Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html
"""

import os

from aws_cdk import (
    Stack,
    CfnOutput,
    Duration,
    aws_bedrockagentcore as agentcore,
    aws_iam as iam,
)
from constructs import Construct


class AgentStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, pre_stack, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        self.pre_stack = pre_stack

        # Build the agent runtime bundle from source at deploy time.
        #
        # The bundle (`source/agent/package`) is a generated artifact — it is
        # NOT committed to git. We recreate it on every deploy by pip-installing
        # the agent's dependencies (strands-agents[bidi] and friends, from PyPI)
        # into a clean directory, then layering the application code on top.
        _agent_dir = os.path.join(os.path.dirname(__file__), "..", "..", "source", "agent")
        agent_source_path = os.path.join(_agent_dir, "package")

        import shutil as _shutil
        import subprocess as _subprocess
        import sys as _sys

        # Start from a clean bundle directory so stale files never leak into a deploy.
        _shutil.rmtree(agent_source_path, ignore_errors=True)
        os.makedirs(agent_source_path, exist_ok=True)

        # Install dependencies into the bundle. AgentCore Runtime executes on
        # Linux / ARM64 (aarch64) / CPython 3.12, so we fetch aarch64 wheels
        # rather than the host's. Multiple --platform tags are supplied because
        # native wheels publish different manylinux tags; pip picks the best
        # match per package. --only-binary=:all: avoids building from source.
        _requirements = os.path.join(_agent_dir, "requirements.txt")
        _subprocess.run(
            [
                _sys.executable, "-m", "pip", "install",
                "--requirement", _requirements,
                "--target", agent_source_path,
                "--platform", "manylinux2014_aarch64",
                "--platform", "manylinux_2_17_aarch64",
                "--platform", "manylinux_2_28_aarch64",
                "--python-version", "3.12",
                "--implementation", "cp",
                "--only-binary=:all:",
                "--upgrade",
            ],
            check=True,
        )

        # Layer the application code into the bundle.
        _shutil.copy2(os.path.join(_agent_dir, "main.py"), agent_source_path)
        _shutil.copy2(os.path.join(_agent_dir, "strands_agent.py"), agent_source_path)
        for _extra in ("call_history_logger.py", "rag_tools.py"):
            _extra_path = os.path.join(_agent_dir, _extra)
            if os.path.exists(_extra_path):
                _shutil.copy2(_extra_path, agent_source_path)
        _tools_src = os.path.join(_agent_dir, "tools")
        _tools_dst = os.path.join(agent_source_path, "tools")
        if os.path.exists(_tools_src):
            _shutil.copytree(_tools_src, _tools_dst, dirs_exist_ok=True)

        # Clean pycache
        for _root, _dirs, _ in os.walk(agent_source_path):
            for _d in _dirs:
                if _d == "__pycache__":
                    _shutil.rmtree(os.path.join(_root, _d), ignore_errors=True)

        agent_runtime_artifact = agentcore.AgentRuntimeArtifact.from_code_asset(
            path=agent_source_path,
            runtime=agentcore.AgentCoreRuntime.PYTHON_3_12,
            entrypoint=["main.py"],
        )

        # Create AgentCore Runtime with WebSocket protocol
        # Uses IAM authentication (default) — clients connect with SigV4 presigned URLs
        self.runtime = agentcore.Runtime(
            self,
            "VoiceAgentRuntime",
            runtime_name="voice_agent_poc",
            agent_runtime_artifact=agent_runtime_artifact,
            description="Voice AI POC-in-a-Box: Nova Sonic BidiAgent with WebSocket streaming",
            protocol_configuration=agentcore.ProtocolType.HTTP,
            environment_variables={
                "BEDROCK_REGION": self.region,
                "MODEL_ID": "amazon.nova-2-sonic-v1:0",
                "VOICE": "tiffany",
                "CALL_HISTORY_BUCKET": f"voice-agent-poc-call-history-{self.account}-{self.region}",
                "CALL_HISTORY_TABLE": "voice-agent-poc-call-history",
                # These point at account-specific resources and are NOT created by
                # this app. Set them per-account at deploy time via CDK context
                # (`-c api_url=... -c kb_id=...`) or env vars. They default to empty;
                # the agent degrades gracefully (RAG/integration tools are skipped)
                # when unset. API_URL is the deployed Demos API base URL; KB_ID is an
                # existing Bedrock Knowledge Base id.
                "API_URL": self.node.try_get_context("api_url") or os.environ.get("API_URL", ""),
                "KB_ID": self.node.try_get_context("kb_id") or os.environ.get("KB_ID", ""),
            },
            lifecycle_configuration=agentcore.LifecycleConfiguration(
                idle_runtime_session_timeout=Duration.minutes(5),
                max_lifetime=Duration.hours(8),
            ),
        )

        # Grant the runtime permission to invoke Nova 2 Sonic
        self.runtime.role.add_to_principal_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:InvokeModelWithBidirectionalStream",
                    "bedrock:Retrieve",
                ],
                resources=["*"],
            )
        )

        # Grant permission to call MCP gateways and invoke other AgentCore runtimes (A2A)
        self.runtime.role.add_to_principal_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock-agentcore:*",
                    "bedrock-agentcore-control:*",
                    "lambda:InvokeFunction",
                ],
                resources=["*"],
            )
        )

        # Grant permission to write call history to S3 and DynamoDB
        self.runtime.role.add_to_principal_policy(
            iam.PolicyStatement(
                actions=[
                    "s3:PutObject",
                    "s3:GetObject",
                ],
                resources=[
                    f"arn:aws:s3:::voice-agent-poc-call-history-{self.account}-{self.region}/*",
                ],
            )
        )
        self.runtime.role.add_to_principal_policy(
            iam.PolicyStatement(
                actions=[
                    "dynamodb:PutItem",
                    "dynamodb:GetItem",
                    "dynamodb:Query",
                ],
                resources=[
                    f"arn:aws:dynamodb:{self.region}:{self.account}:table/voice-agent-poc-call-history",
                ],
            )
        )

        # Outputs
        CfnOutput(
            self,
            "AgentRuntimeId",
            value=self.runtime.agent_runtime_id,
            description="AgentCore Runtime ID",
        )
        CfnOutput(
            self,
            "AgentRuntimeArn",
            value=self.runtime.agent_runtime_arn,
            description="AgentCore Runtime full ARN",
        )
        CfnOutput(
            self,
            "AgentCoreWsUrl",
            value=f"wss://bedrock-agentcore.{self.region}.amazonaws.com/runtimes/{self.runtime.agent_runtime_arn}/ws",
            description="AgentCore WebSocket URL for the voice agent",
        )
