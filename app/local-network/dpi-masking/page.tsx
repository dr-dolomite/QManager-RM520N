import { redirect } from "next/navigation";

// Old DPI Masking bookmarks land on the Traffic Engine page.
export default function DPIMaskingPage() {
  redirect("/local-network/traffic-engine");
}
