import LegalLayout, { LegalList, LegalSection } from "../../components/LegalLayout";
import { COMPANY, SUBPROCESSORS } from "../../legal/companyInfo";

export default function MentionsLegalesPage() {
  return (
    <LegalLayout title="Mentions légales">
      <LegalSection title="1. Éditeur du site">
        <p>
          Le service {COMPANY.tradeName} (le « Service ») est édité par :
        </p>
        <LegalList
          items={[
            <>Nom : <strong className="text-slate-100">{COMPANY.fullName}</strong></>,
            <>Statut juridique : {COMPANY.legalStatus}</>,
            <>Numéro SIRET : {COMPANY.siret}</>,
            <>Adresse : {COMPANY.address}</>,
            <>Email de contact : {COMPANY.contactEmail}</>,
            <>Pays : {COMPANY.country}</>,
          ]}
        />
        <p>
          Directeur de la publication : {COMPANY.fullName}.
        </p>
      </LegalSection>

      <LegalSection title="2. Hébergement">
        <p>Le Service est hébergé par les prestataires suivants :</p>
        <LegalList
          items={[
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.hostingFrontendBackend.name}</strong> —{" "}
              {SUBPROCESSORS.hostingFrontendBackend.address} — hébergement de l'application web et des
              fonctions serveur.
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.database.name}</strong> —{" "}
              {SUBPROCESSORS.database.address} — hébergement de la base de données et des fichiers
              (photos, pièces d'identité, documents).
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Propriété intellectuelle">
        <p>
          L'ensemble des éléments composant le Service (structure, textes, logos, graphismes, code source)
          est la propriété exclusive de l'éditeur, sauf mention contraire. Toute reproduction, représentation,
          modification ou exploitation non autorisée, totale ou partielle, de ces éléments est interdite.
        </p>
      </LegalSection>

      <LegalSection title="4. Responsabilité">
        <p>
          L'éditeur s'efforce d'assurer l'exactitude et la mise à jour des informations diffusées sur le
          Service, mais ne peut garantir l'absence totale d'erreurs ou d'interruptions. L'éditeur ne saurait
          être tenu responsable des dommages directs ou indirects résultant de l'utilisation du Service ou de
          l'impossibilité d'y accéder.
        </p>
        <p>
          Les Gestionnaires (agences, bailleurs) restent seuls responsables de l'exactitude des informations
          qu'ils saisissent concernant leurs biens, locataires et contrats.
        </p>
      </LegalSection>

      <LegalSection title="5. Données personnelles">
        <p>
          Le traitement des données personnelles collectées via le Service est décrit dans la{" "}
          <a href="/confidentialite" className="text-brand-400 hover:text-brand-300 underline">
            Politique de confidentialité
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="6. Contact">
        <p>
          Pour toute question relative aux présentes mentions légales, vous pouvez contacter l'éditeur à
          l'adresse : {COMPANY.contactEmail}.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
