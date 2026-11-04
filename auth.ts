import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { refreshToken, signInGate } from "@/lib/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  // A refused sign-in comes back as /masuk?error=AccessDenied.
  pages: { signIn: "/masuk", error: "/masuk" },
  callbacks: {
    signIn: ({ profile }) => signInGate(profile),
    jwt: ({ token, profile }) => refreshToken(token, profile),
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
