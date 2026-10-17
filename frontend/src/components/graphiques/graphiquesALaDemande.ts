import { lazyWithReload } from "../../utils/lazyWithReload";

/**
 * Les graphiques, chargés à la demande : la bibliothèque `recharts` pèse ≈ 380 Ko avant compression. Les pages
 * affichent leurs chiffres tout de suite et un squelette à la place du graphique, qui arrive ensuite.
 */
export const GraphiqueRevenusDepenses = lazyWithReload(() =>
  import("./Graphiques").then((m) => ({ default: m.GraphiqueRevenusDepenses }))
);
export const GraphiqueParc = lazyWithReload(() => import("./Graphiques").then((m) => ({ default: m.GraphiqueParc })));
export const GraphiqueComparaisonFiscale = lazyWithReload(() =>
  import("./Graphiques").then((m) => ({ default: m.GraphiqueComparaisonFiscale }))
);
