/**
 * Generates a SigV4-presigned WebSocket URL for Bedrock AgentCore Runtime.
 *
 * The browser's WebSocket API cannot set custom headers during the handshake,
 * so we embed the SigV4 signature as query parameters in the URL.
 *
 * Flow:
 * 1. Get temporary AWS credentials from Cognito Identity Pool
 * 2. Build the canonical request for the AgentCore WebSocket endpoint
 * 3. Sign it with SigV4 and append the signature as query params
 * 4. Return the presigned wss:// URL ready for `new WebSocket(url)`
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity';

interface PresignOptions {
  /** AgentCore Runtime ARN or ID */
  runtimeArn: string;
  /** AWS region (e.g., "us-east-1") */
  region: string;
  /** Cognito Identity Pool ID (e.g., "us-east-1:xxxxxxxx-xxxx-...") */
  identityPoolId: string;
  /** Cognito User Pool ID token (JWT from authenticated user) */
  idToken: string;
  /** Cognito User Pool provider name (e.g., "cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX") */
  userPoolProviderName: string;
  /** Optional session ID for conversation continuity */
  sessionId?: string;
  /** Presigned URL expiration in seconds (default: 300) */
  expiresIn?: number;
}

/**
 * Generate a presigned WebSocket URL for AgentCore Runtime.
 *
 * @returns A `wss://` URL with SigV4 query parameters that can be used
 *          directly with `new WebSocket(url)` in the browser.
 */
export async function generatePresignedWsUrl(
  options: PresignOptions
): Promise<string> {
  const {
    runtimeArn,
    region,
    identityPoolId,
    idToken,
    userPoolProviderName,
    sessionId,
    expiresIn = 300,
  } = options;

  // Get temporary credentials from Cognito Identity Pool
  const cognitoClient = new CognitoIdentityClient({ region });

  // Step 1: Get Identity ID
  const getIdResponse = await cognitoClient.send(
    new GetIdCommand({
      IdentityPoolId: identityPoolId,
      Logins: {
        [userPoolProviderName]: idToken,
      },
    })
  );

  // Step 2: Get credentials for the identity
  const credentialsResponse = await cognitoClient.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: getIdResponse.IdentityId!,
      Logins: {
        [userPoolProviderName]: idToken,
      },
    })
  );

  const creds = credentialsResponse.Credentials!;
  const credentials = {
    accessKeyId: creds.AccessKeyId!,
    secretAccessKey: creds.SecretKey!,
    sessionToken: creds.SessionToken!,
  };

  // Build the WebSocket endpoint URL
  // Docs: wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<urlEncodedArn>/ws
  const host = `bedrock-agentcore.${region}.amazonaws.com`;
  // Pass the raw path — let the signer handle URI encoding
  const path = `/runtimes/${runtimeArn}/ws`;

  // Build query parameters
  const queryParams: Record<string, string> = {};
  if (sessionId) {
    queryParams['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'] = sessionId;
  }

  // Create the HTTP request to sign
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname: host,
    path,
    query: queryParams,
    headers: {
      host,
    },
  });

  // Sign the request with SigV4
  const signer = new SignatureV4({
    credentials,
    region,
    service: 'bedrock-agentcore',
    sha256: Sha256,
  });

  const presigned = await signer.presign(request, {
    expiresIn,
  });

  // Build the final presigned URL from the signed request
  const signedPath = presigned.path;
  const queryString = Object.entries(presigned.query || {})
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join('&');

  return `wss://${host}${signedPath}?${queryString}`;
}

/**
 * Simplified helper that uses environment variables for configuration.
 * Falls back to the raw WebSocket URL if Cognito config is not available
 * or if AgentCore presigning is not configured.
 */
export async function getAgentCoreWsUrl(
  idToken: string,
  sessionId?: string
): Promise<string> {
  const runtimeArn = import.meta.env.VITE_AGENTCORE_RUNTIME_ARN || '';
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
  const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || '';
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
  const fallbackUrl = import.meta.env.VITE_AGENTCORE_WS_URL || 'ws://localhost:8081/ws';

  // If AgentCore config is not set, fall back to direct WebSocket URL (local dev)
  if (!runtimeArn || !identityPoolId || !userPoolId || !idToken) {
    return fallbackUrl;
  }

  const userPoolProviderName = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

  try {
    return await generatePresignedWsUrl({
      runtimeArn,
      region,
      identityPoolId,
      idToken,
      userPoolProviderName,
      sessionId,
    });
  } catch (err) {
    console.warn('Failed to generate presigned URL, falling back to direct URL:', err);
    return fallbackUrl;
  }
}
