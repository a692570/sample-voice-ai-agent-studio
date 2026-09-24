"""
Post Stack — Post-deployment Configuration

Handles:
  - Creating initial Cognito users from environment variable
  - Adding admin users to the 'admin' group
  - Injecting runtime config (WebSocket URL, Cognito IDs) into frontend
"""

import os

from aws_cdk import (
    Stack,
    CfnOutput,
    CustomResource,
    aws_lambda as lambda_,
    aws_iam as iam,
    custom_resources as cr,
    Duration,
)
from constructs import Construct


class PostStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, pre_stack, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        user_emails = os.environ.get("CDK_INPUT_USER_EMAILS", "")
        admin_emails = os.environ.get("CDK_INPUT_ADMIN_EMAILS", "lanaz@amazon.com")

        # Lambda to create Cognito users and assign groups
        create_users_fn = lambda_.Function(
            self,
            "CreateUsersFn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="index.handler",
            code=lambda_.Code.from_inline(self._get_create_users_code()),
            environment={
                "USER_POOL_ID": pre_stack.user_pool.user_pool_id,
                "USER_EMAILS": user_emails,
                "ADMIN_EMAILS": admin_emails,
            },
            timeout=Duration.seconds(60),
        )

        # Grant Cognito admin permissions
        create_users_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminSetUserPassword",
                    "cognito-idp:AdminAddUserToGroup",
                ],
                resources=[pre_stack.user_pool.user_pool_arn],
            )
        )

        # Custom resource to trigger user creation on deploy
        if user_emails or admin_emails:
            provider = cr.Provider(
                self, "CreateUsersProvider", on_event_handler=create_users_fn
            )
            CustomResource(
                self,
                "CreateUsersResource",
                service_token=provider.service_token,
                properties={"emails": user_emails, "admins": admin_emails},
            )

        CfnOutput(self, "ConfiguredUsers", value=user_emails or "(none)")
        CfnOutput(self, "AdminUsers", value=admin_emails or "(none)")

    def _get_create_users_code(self) -> str:
        return """
import boto3
import os
import json

def handler(event, context):
    if event.get('RequestType') == 'Delete':
        return {'PhysicalResourceId': event.get('PhysicalResourceId', 'users')}

    import re

    client = boto3.client('cognito-idp')
    user_pool_id = os.environ['USER_POOL_ID']
    emails = [e.strip() for e in os.environ.get('USER_EMAILS', '').split(',') if e.strip()]
    admin_emails = [e.strip() for e in os.environ.get('ADMIN_EMAILS', '').split(',') if e.strip()]

    # The user pool uses email as an ALIAS, so the Username itself cannot be an
    # email. Derive a Cognito-safe username from the email local-part and set the
    # email as an attribute (which still lets users sign in with their email).
    def username_for(email):
        local = email.split('@', 1)[0]
        uname = re.sub(r'[^a-zA-Z0-9._-]', '_', local) or 'user'
        return uname

    # Map each email -> username once, reused for create + group assignment.
    email_to_username = {e: username_for(e) for e in set(emails + admin_emails)}

    # Create all users (regular + admin)
    for email, uname in email_to_username.items():
        try:
            client.admin_create_user(
                UserPoolId=user_pool_id,
                Username=uname,
                UserAttributes=[
                    {'Name': 'email', 'Value': email},
                    {'Name': 'email_verified', 'Value': 'true'},
                ],
                DesiredDeliveryMediums=['EMAIL'],
            )
            print(f"Created user: {uname} ({email})")
        except client.exceptions.UsernameExistsException:
            print(f"User already exists: {uname} ({email})")
        except Exception as e:
            print(f"Error creating user {uname} ({email}): {e}")

    # Add admin users to the 'admin' group
    for email in admin_emails:
        uname = email_to_username[email]
        try:
            client.admin_add_user_to_group(
                UserPoolId=user_pool_id,
                Username=uname,
                GroupName='admin',
            )
            print(f"Added {uname} ({email}) to admin group")
        except Exception as e:
            print(f"Error adding {uname} ({email}) to admin group: {e}")

    # Add regular users to the 'user' group
    regular_only = [e for e in emails if e not in admin_emails]
    for email in regular_only:
        uname = email_to_username[email]
        try:
            client.admin_add_user_to_group(
                UserPoolId=user_pool_id,
                Username=uname,
                GroupName='user',
            )
            print(f"Added {uname} ({email}) to user group")
        except Exception as e:
            print(f"Error adding {email} to user group: {e}")

    return {'PhysicalResourceId': 'users'}
"""
