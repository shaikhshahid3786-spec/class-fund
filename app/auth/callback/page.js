"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, ADMIN_EMAIL } from "../../../lib/supabaseClient";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        router.replace(session.user.email === ADMIN_EMAIL ? "/admin" : "/student");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        router.replace(data.session.user.email === ADMIN_EMAIL ? "/admin" : "/student");
      }
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="loading">Signing you in…</div>;
}
