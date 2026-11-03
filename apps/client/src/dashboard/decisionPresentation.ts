import type {
  ActionExplanation,
  ActionRecord,
  WorldActionInput,
} from "../../../../packages/shared/src/index.js";

const outcomes: Record<string, string> = {
  ENCOUNTER:
    "Gestopt bij een nieuwe ontmoeting in de buurt om opnieuw te kiezen.",
  OUT_OF_RANGE: "Het object is nog te ver weg; eerst dichterbij lopen.",
  OBJECT_UNAVAILABLE: "Het object is inmiddels in bezit van een agent.",
  INVENTORY_FULL: "De voorwerpentas heeft onvoldoende vrije plekken.",
  MISSING_MATERIALS: "Er ontbreken materialen voor dit recept.",
  WORKBENCH_REQUIRED: "Leg een werkbank neer en ga er dichtbij staan.",
  RESOURCE_DEPLETED: "Deze bron bevat geen materialen meer.",
  PLACE_FIRST: "Leg dit voorwerp eerst neer.",
  NOT_MOVABLE: "Dit object kan niet worden gedragen.",
  NOT_VISIBLE: "Het object is bij uitvoering niet zichtbaar.",
  UNREACHABLE: "De navigatie vindt geen begaanbare route naar het doel.",
  PATH_BLOCKED:
    "De route bleef te lang geblokkeerd, bijvoorbeeld door een andere agent.",
  DROP_BLOCKED:
    "Op de gekozen neerlegplek staat een object of agent, of het terrein is ongeschikt.",
  JUMP_UNREACHABLE: "De sprong is te ver, te hoog of geblokkeerd.",
  THROW_UNREACHABLE: "De worp is te ver, te hoog of geblokkeerd.",
  FLIGHT_BLOCKED: "De vlucht werd geblokkeerd.",
  NOT_GROUNDED: "De agent staat nog niet op een oppervlak.",
  NOT_OWNER: "De agent draagt dit object niet.",
};
export const outcomeReason = (error?: string) => {
  if (!error) return "";
  if (/CODEX_RATE_LIMITED|\b429\b|too many requests/i.test(error))
    return "Codex heeft de aanvraaglimiet bereikt (429). De agents wachten tijdelijk en proberen het daarna automatisch opnieuw.";
  return outcomes[error] ?? error;
};
export function actionTitle(action: WorldActionInput) {
  switch (action.type) {
    case "craft":
      return `Maken · ${action.recipeId}`;
    case "gather":
      return `Materialen verzamelen · ${action.entityId}`;
    case "pickup":
      return `Oppakken · ${action.entityId}`;
    case "inspect":
      return `Onderzoeken · ${action.entityId}`;
    case "interact":
      return `Activeren · ${action.entityId}`;
    case "drop":
      return `Neerleggen · ${action.entityId}`;
    case "throw":
      return `Gooien · ${action.entityId}`;
    case "jump":
      return `Springen naar (${action.target.x.toFixed(1)}, ${action.target.z.toFixed(1)})`;
    case "move":
      return `Lopen naar (${action.target.x.toFixed(1)}, ${action.target.z.toFixed(1)})`;
    case "look":
      return "Rondkijken";
    case "communicate":
      return `Bericht aan ${action.recipientId}`;
    case "wait":
      return `Wachten · ${(action.durationMs / 1000).toFixed(1)} s`;
  }
}
export function appendExplanation(
  parent: HTMLElement,
  explanation: ActionExplanation,
) {
  if (explanation.motivation) {
    const reason = document.createElement("p");
    reason.className = "decision-motivation";
    reason.textContent = `Motivatie: ${explanation.motivation}`;
    parent.append(reason);
  }
  if (explanation.artifactConsiderations?.length) {
    const list = document.createElement("ul");
    list.className = "artifact-considerations";
    const labels = {
      pickup: "Oppakken",
      approach: "Benaderen",
      keep: "Meenemen",
      defer: "Uitstellen",
      leave: "Laten liggen",
      inspect: "Ter plaatse onderzoeken",
      place: "Neerleggen",
    };
    for (const consideration of explanation.artifactConsiderations) {
      const item = document.createElement("li");
      item.textContent = `${consideration.entityId} · ${labels[consideration.decision]}: ${consideration.reason}`;
      list.append(item);
    }
    parent.append(list);
  }
}
export function appendOutcome(parent: HTMLElement, outcome?: ActionRecord) {
  if (!outcome) return;
  const result = document.createElement("p");
  result.className = outcome.error ? "event-failed" : "decision-outcome";
  const statuses = {
    queued: "In wachtrij",
    running: "In uitvoering",
    succeeded: "Geslaagd",
    failed: "Mislukt",
    cancelled: "Geannuleerd",
  };
  result.textContent = `Uitvoering: ${statuses[outcome.status]}${outcome.error ? " · " + outcomeReason(outcome.error) : ""}`;
  parent.append(result);
}
