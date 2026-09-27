// The two discovery documents a hosted MCP server must publish so Claude/Cursor
// can find the auth server: Protected-Resource metadata (RFC 9728) and
// Authorization-Server metadata (RFC 8414). Built from PUBLIC_BASE_URL.

export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp', 'mcp:write'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/`,
  };
}

export function authServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: ['mcp', 'mcp:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}
