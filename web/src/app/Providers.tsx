import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type * as React from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={150} skipDelayDuration={300}>
        <ConfirmProvider>
          {children}
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
