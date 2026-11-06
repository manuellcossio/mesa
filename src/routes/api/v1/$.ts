import { createFileRoute } from "@tanstack/react-router";
import { handleMesa } from "@/lib/mesa-api.server";

const handle = ({ request }: { request: Request }) => handleMesa(request);

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
});
