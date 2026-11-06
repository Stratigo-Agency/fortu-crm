import type { Instrumentation } from "next";
import { requestErrorLine } from "@/lib/errorLog";

// Next.js calls this for every error it did not handle (a page, a Server Action or a route handler).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  console.error(JSON.stringify(requestErrorLine(err, request, context)));
};
