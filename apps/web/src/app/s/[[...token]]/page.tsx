import SessionClient from "./SessionClient";

export function generateStaticParams() {
  return [{ token: ["_"] }];
}

export default function SessionPage() {
  return <SessionClient />;
}
