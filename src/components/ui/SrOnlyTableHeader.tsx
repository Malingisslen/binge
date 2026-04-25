export default function SrOnlyTableHeader({ columns }: { columns: string[] }) {
  return (
    <thead className="sr-only">
      <tr>
        {columns.map(col => (
          <th key={col} scope="col">{col}</th>
        ))}
      </tr>
    </thead>
  );
}
