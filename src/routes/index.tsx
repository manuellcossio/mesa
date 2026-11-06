import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/mesa/desk";

export const Route = createFileRoute("/")({ component: Desk });
