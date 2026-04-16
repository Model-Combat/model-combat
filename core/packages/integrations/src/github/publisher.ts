import { Octokit } from "@octokit/rest";

export interface GitHubPublisherConfig {
  token: string;
  liveOrg: string;
  archiveOrg: string;
}

export interface PublishRoundRepoInput {
  roundId: string;
  repoName: string;
  description: string;
  private: boolean;
}

export class GitHubPublisher {
  private readonly octokit: Octokit;

  constructor(private readonly config: GitHubPublisherConfig) {
    this.octokit = new Octokit({ auth: config.token });
  }

  async createRoundRepo(input: PublishRoundRepoInput): Promise<string> {
    const response = await this.octokit.repos.createInOrg({
      org: this.config.liveOrg,
      name: input.repoName,
      description: input.description,
      private: input.private,
      auto_init: false,
    });

    return response.data.html_url;
  }

  async createArchiveRepo(input: PublishRoundRepoInput): Promise<string> {
    const response = await this.octokit.repos.createInOrg({
      org: this.config.archiveOrg,
      name: input.repoName,
      description: input.description,
      private: false,
      auto_init: false,
    });

    return response.data.html_url;
  }
}
