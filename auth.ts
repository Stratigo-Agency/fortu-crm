import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { refreshToken, signInGate } from "@/lib/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
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
