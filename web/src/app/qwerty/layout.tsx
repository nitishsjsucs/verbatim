"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProvider } from "convex/react";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * Qwerty mode subtree provider.
 *
 * Wraps only /qwerty/* pages with the qwerty Convex deployment.
 * The rest of govinda's web app is unaffected.
 */
export default function QwertyLayout({ children }: { children: ReactNode }) {
    const [client] = useState(() => {
        const url = process.env.NEXT_PUBLIC_QWERTY_CONVEX_URL;
        if (!url) {
            // Returning null lets us render a clear empty state below.
            return null;
        }
        return new ConvexReactClient(url);
    });

    if (!client) {
        return (
            <div style={{ padding: 32, fontFamily: "var(--font-inter)" }}>
                <h2>Qwerty mode is not configured</h2>
                <p>
                    Set <code>NEXT_PUBLIC_QWERTY_CONVEX_URL</code> in <code>web/.env.local</code> and
                    deploy <code>convex_qwerty/</code> first. See <code>qwerty_mode/README.md</code>.
                </p>
            </div>
        );
    }

    return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
