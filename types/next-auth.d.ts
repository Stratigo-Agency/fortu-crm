import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; full_name: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    full_name?: string;
    /** ms since epoch of the last users-row read */
    roleCheckedAt?: number;
  }
}
