import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface OAuthIdentity {
  providerId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
}

const googleClient = env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID) : null;

/**
 * Verifies a Google ID token's signature and audience server-side - never
 * trust a client-asserted email/name directly, only what Google's own
 * signed token says. Returns null on any invalid/expired/wrong-audience
 * token rather than throwing, so callers have one failure path.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<OAuthIdentity | null> {
  if (!googleClient || !env.GOOGLE_OAUTH_CLIENT_ID) {
    logger.warn('verifyGoogleIdToken called but GOOGLE_OAUTH_CLIENT_ID is not configured');
    return null;
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return null;

    return {
      providerId: payload.sub,
      email: payload.email ?? null,
      displayName: payload.name ?? payload.email?.split('@')[0] ?? 'Player',
      avatarUrl: payload.picture ?? null,
    };
  } catch (err) {
    logger.warn({ err }, 'Google ID token verification failed');
    return null;
  }
}

/**
 * Verifies a Facebook access token by asking Facebook's own Graph API who
 * it belongs to - the token only proves identity if Facebook itself
 * confirms it, so this never trusts client-provided profile fields.
 */
export async function verifyFacebookAccessToken(accessToken: string): Promise<OAuthIdentity | null> {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    logger.warn('verifyFacebookAccessToken called but FACEBOOK_APP_ID/SECRET is not configured');
    return null;
  }
  try {
    // debug_token confirms this access token was actually issued to OUR
    // app (not a token for some other Facebook app) before trusting it.
    const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;
    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`,
    );
    const debugData = (await debugRes.json()) as {
      data?: { is_valid?: boolean; app_id?: string };
    };
    if (!debugRes.ok || !debugData?.data?.is_valid || debugData.data.app_id !== env.FACEBOOK_APP_ID) {
      logger.warn({ debugData }, 'Facebook token failed debug_token validation');
      return null;
    }

    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`,
    );
    const profile = (await profileRes.json()) as {
      id?: string;
      name?: string;
      email?: string;
      picture?: { data?: { url?: string } };
    };
    if (!profileRes.ok || !profile?.id) return null;

    return {
      providerId: profile.id,
      email: profile.email ?? null,
      displayName: profile.name ?? 'Player',
      avatarUrl: profile.picture?.data?.url ?? null,
    };
  } catch (err) {
    logger.warn({ err }, 'Facebook access token verification failed');
    return null;
  }
}
