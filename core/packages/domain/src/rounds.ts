import type { RepoPoolEntry, RoundBundle, RoundModel, ServiceTemplate } from "@model-combat/contracts";

export function assertRoundServices(services: ServiceTemplate[]): void {
  if (services.length !== 3) {
    throw new Error(`rounds must contain exactly 3 services, received ${services.length}`);
  }

  const uniqueBuckets = new Set(services.map((service) => service.bucket));
  if (uniqueBuckets.size !== 3) {
    throw new Error("rounds must contain one service from each pool bucket");
  }
}

export function buildRoundBundle(args: {
  roundId: string;
  seedModels: RoundModel[];
  competitorRoster: RoundModel[];
  services: RepoPoolEntry[];
  seededRepoRefs: string[];
  findingManifestRefs: string[];
  verifierResults: RoundBundle["verifierResults"];
  runtimeBackend: RoundBundle["runtimeBackend"];
  runtimeImageRef: string;
  digest: string;
}): RoundBundle {
  const serviceTemplates = args.services.map(({ qualificationStatus: _status, whyIncluded: _whyIncluded, adapterShape: _adapterShape, sourceUrls: _sourceUrls, ...service }) => service);

  assertRoundServices(serviceTemplates);

  return {
    roundId: args.roundId,
    seedModels: args.seedModels,
    competitorRoster: args.competitorRoster,
    serviceTemplates,
    seededRepoRefs: args.seededRepoRefs,
    findingManifestRefs: args.findingManifestRefs,
    verifierResults: args.verifierResults,
    judgeConfig: {
      roundDurationMinutes: 60,
      waveDurationMinutes: 5,
      flagTtlWaves: 3,
    },
    runtimeBackend: args.runtimeBackend,
    runtimeImageRef: args.runtimeImageRef,
    createdAt: new Date().toISOString(),
    digest: args.digest,
  };
}
