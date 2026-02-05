import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@screenshare-guide/trpc";

export const trpc = createTRPCReact<AppRouter>();
