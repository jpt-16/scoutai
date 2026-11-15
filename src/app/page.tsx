import { redirect } from "next/navigation";

// The landing page is removed for now; the script page handles the empty state
// (upload or demo). A redesigned landing page can replace this later.
export default function Home() {
  redirect("/script");
}
