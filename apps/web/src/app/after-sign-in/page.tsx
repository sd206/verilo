import { redirect } from "next/navigation";
import { getAuth } from "@/server/context";
import { nextPathFor } from "@/server/handlers/common";

export const dynamic = "force-dynamic";

/** Where Auth.js lands after a magic-link sign-in. */
export default async function AfterSignIn() {
  const auth = await getAuth();
  redirect(auth ? nextPathFor(auth.state) : "/sign-in");
}
