import { EC2Client } from "@aws-sdk/client-ec2";
import { KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";

export interface AwsIntegrationClients {
  ec2: EC2Client;
  kms: KMSClient;
  s3: S3Client;
}

export function createAwsClients(region: string): AwsIntegrationClients {
  return {
    ec2: new EC2Client({ region }),
    kms: new KMSClient({ region }),
    s3: new S3Client({ region }),
  };
}
