import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { signInGate } from "@/lib/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    signIn: ({ profile }) => signInGate(profile),
  },
});
