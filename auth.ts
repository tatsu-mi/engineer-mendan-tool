import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

function getEmployeeEmail(profile: { email?: unknown; preferred_username?: unknown }) {
  const value = typeof profile.email === 'string'
    ? profile.email
    : profile.preferred_username;
  if (typeof value !== 'string') return null;

  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function getConfiguredTenantId() {
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  return issuer
    ?.match(/^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0\/?$/i)?.[1]
    ?.toLowerCase() ?? null;
}

export const { handlers, auth, signIn } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: { params: { scope: 'openid profile email' } },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: getEmployeeEmail(profile),
          image: null
        };
      }
    })
  ],
  callbacks: {
    signIn({ profile }) {
      const configuredTenantId = getConfiguredTenantId();
      const profileTenantId = profile && typeof profile.tid === 'string'
        ? profile.tid.toLowerCase()
        : null;
      const email = profile ? getEmployeeEmail(profile) : null;

      return Boolean(email && configuredTenantId && profileTenantId === configuredTenantId);
    },
    jwt({ token, profile }) {
      if (profile) {
        token.email = getEmployeeEmail(profile);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.email === 'string') {
        session.user.email = token.email;
      }
      return session;
    }
  },
  pages: {
    signIn: '/'
  },
  session: {
    strategy: 'jwt'
  }
});
