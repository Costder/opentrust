export function PermissionTable({ permissions }: { permissions: Record<string, unknown> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {Object.entries(permissions).map(([key, value]) => (
          <tr key={key} className="border-b border-stone-200">
            <td className="py-2 font-medium">{key}</td>
            <td className="py-2 text-right">{String(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
