"""
Shared authentication utilities for multi-tenancy.

Extracts user identity and role from Cognito JWT claims passed by
API Gateway's built-in Cognito authorizer.

Usage in handlers:
    from auth_utils import get_user_context

    def handler(event, context):
        user_ctx = get_user_context(event)
        user_id = user_ctx["userId"]
        is_admin = user_ctx["isAdmin"]
"""


def get_user_context(event):
    """
    Extract user identity and admin status from the API Gateway event.

    API Gateway Cognito authorizer populates:
      event['requestContext']['authorizer']['claims']

    Returns:
        dict with keys:
            - userId (str): The Cognito 'sub' (unique user ID)
            - email (str): User's email address
            - isAdmin (bool): Whether user belongs to the 'admin' group
            - groups (list): All Cognito groups the user belongs to
    """
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )

    user_id = claims.get("sub", "")
    email = claims.get("email", "")

    # Cognito puts groups in 'cognito:groups' claim as a comma-separated string
    # or as a space-separated string depending on token type
    groups_raw = claims.get("cognito:groups", "")
    if isinstance(groups_raw, str):
        # Could be comma-separated or space-separated
        groups = [g.strip() for g in groups_raw.replace(",", " ").split() if g.strip()]
    elif isinstance(groups_raw, list):
        groups = groups_raw
    else:
        groups = []

    is_admin = "admin" in groups

    # Fallback for local dev (no authorizer)
    if not user_id:
        user_id = "local-dev"
        email = "local-dev@example.com"
        is_admin = True

    return {
        "userId": user_id,
        "email": email,
        "isAdmin": is_admin,
        "groups": groups,
    }


def check_item_access(item, user_ctx):
    """
    Check if a user has access to a specific item.

    Admins can access any item. Regular users can only access items
    they own (matching userId) or items without a userId (legacy items).

    Returns:
        bool: True if user has access
    """
    if user_ctx["isAdmin"]:
        return True

    item_owner = item.get("userId", "")
    # Allow access to legacy items without userId (backward compat)
    if not item_owner:
        return True

    return item_owner == user_ctx["userId"]
