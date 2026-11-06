import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authorizeCredentials, refreshToken, signInGate } from "@/lib/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Email + password for people whose work address has no Google account yet.
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: ({ email, password }, request) => authorizeCredentials(email, password, request.headers),
    }),
    Google,
  ],
  session: { strategy: "jwt" },
  // A refused sign-in comes back as /masuk?error=AccessDenied (Google) or CredentialsSignin (password).
  pages: { signIn: "/masuk", error: "/masuk" },
  callbacks: {
    // Credentials sign-ins are already checked in authorize(); only Google needs the gate.
    signIn: ({ account, profile }) =>
      account?.provider === "credentials" ? true : signInGate(profile),
    jwt: ({ token, profile, user }) => refreshToken(token, profile, undefined, user?.id),
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.id!,
        role: token.role!,
        full_name: token.full_name!,
      },
    }),
  },
});
