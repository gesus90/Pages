import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/** Delays loading placeholders to avoid flashing during short route revalidations. */
export function useManagementPending(): boolean {
  const navigation = useNavigation();
  const [isPending, setIsPending] = useState(false);
  useEffect(() => {
    setIsPending(false);
    if (navigation.state !== "loading") return;
    const timer = window.setTimeout(() => setIsPending(true), 200);
    return () => window.clearTimeout(timer);
  }, [navigation.state]);
  return navigation.state === "loading" && isPending;
}
