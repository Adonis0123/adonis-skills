import { notFound } from "next/navigation";

// Unmatched paths under a locale render the styled [lang]/not-found page.
export default function CatchAllPage(): never {
  notFound();
}
