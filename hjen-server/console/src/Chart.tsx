import { BarChart } from '@tremor/react';

// Isolated so its heavy dependency (recharts, via Tremor charts) is code-split
// into its own chunk — loaded lazily only when a chart actually renders.
export default function Chart({ data }: { data: any[] }) {
  return (
    <BarChart data={data} index="day" categories={['Makes']} colors={['amber']}
      showLegend={false} yAxisWidth={30} className="h-44 mt-3" />
  );
}
