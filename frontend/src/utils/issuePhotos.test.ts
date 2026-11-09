import { describe, expect, it } from "vitest";
import type { IssueReport } from "../types";
import { getAllIssuePhotos, MAX_PHOTOS_PAR_INCIDENT, peutAjouterUnePhoto } from "./issuePhotos";

const incident = (photoUrl: string, additionalPhotos: string | null = null) => ({ photoUrl, additionalPhotos }) as IssueReport;

describe("getAllIssuePhotos", () => {
  it("renvoie la photo principale puis les photos supplémentaires", () => {
    expect(getAllIssuePhotos(incident("a.jpg", JSON.stringify(["b.jpg", "c.jpg"])))).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("écarte la photo principale vide : le serveur renvoie une chaîne vide quand il n'a pas pu la signer", () => {
    expect(getAllIssuePhotos(incident("", JSON.stringify(["b.jpg"])))).toEqual(["b.jpg"]);
    expect(getAllIssuePhotos(incident(""))).toEqual([]);
  });

  it("écarte les entrées vides ou illisibles des photos supplémentaires", () => {
    expect(getAllIssuePhotos(incident("a.jpg", JSON.stringify(["", "b.jpg", null, 3])))).toEqual(["a.jpg", "b.jpg"]);
    expect(getAllIssuePhotos(incident("a.jpg", "pas du json"))).toEqual(["a.jpg"]);
  });
});

describe("peutAjouterUnePhoto", () => {
  const supplementaires = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `p${i}.jpg`));

  it("accepte tant qu'il y a moins de 10 photos, la principale comprise", () => {
    expect(MAX_PHOTOS_PAR_INCIDENT).toBe(10);
    expect(peutAjouterUnePhoto(incident("a.jpg", supplementaires(8)))).toBe(true);
    expect(peutAjouterUnePhoto(incident("a.jpg", supplementaires(9)))).toBe(false);
  });
});
