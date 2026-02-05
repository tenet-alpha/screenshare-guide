"use client";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function SessionList() {
  const { data: sessions, isLoading, error } = trpc.session.list.useQuery({
    includeExpired: false,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner text-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
        Failed to load sessions: {error.message}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No active sessions.</p>
        <p className="text-sm mt-2">Create a session link from a template to get started!</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "active":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "expired":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const copyToClipboard = (token: string) => {
    const url = `${window.location.origin}/s/${token}`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Token</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Progress</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Created</th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Expires</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <td className="py-3 px-4">
                <code className="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                  {session.token}
                </code>
              </td>
              <td className="py-3 px-4">
                <span
                  className={cn(
                    "inline-block px-2 py-1 text-xs font-medium rounded-full",
                    getStatusColor(session.status)
                  )}
                >
                  {session.status}
                </span>
              </td>
              <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                Step {session.currentStep + 1}
              </td>
              <td className="py-3 px-4 text-sm text-gray-500">
                {new Date(session.createdAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4 text-sm text-gray-500">
                {new Date(session.expiresAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4 text-right">
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => copyToClipboard(session.token)}
                    className="px-3 py-1 text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                  >
                    Copy Link
                  </button>
                  <a
                    href={`/s/${session.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  >
                    Open
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
