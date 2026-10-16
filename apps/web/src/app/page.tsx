import { redirect } from "next/navigation";
import { getAuth } from "@/server/context";
import { nextPathFor } from "@/server/handlers/common";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await getAuth();
  redirect(auth ? nextPathFor(auth.state) : "/sign-in");
}
