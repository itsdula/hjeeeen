import { useStore } from '../store';

export function RightSidebarToggle() {
  const layersOpen = useStore(s => s.layersOpen);
  const layerCount = useStore(s => s.layers.length);
  const toggle = useStore(s => s.toggleLayers);

  return (
    <button
      className="layers-toggle no-drag"
      onClick={toggle}
      title={layersOpen ? 'Hide layers (⌘L)' : 'Show layers (⌘L)'}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M8 2.5l-5.5 3 5.5 3 5.5-3z"/>
        <path d="M2.5 8.5l5.5 3 5.5-3"/>
        <path d="M2.5 11.5l5.5 3 5.5-3"/>
      </svg>
      {layerCount > 0 && <span className="layers-toggle__count">{layerCount}</span>}
    </button>
  );
}
