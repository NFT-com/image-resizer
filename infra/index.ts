import * as aws from "@pulumi/aws"
import * as docker from '@pulumi/docker'
import * as pulumi from "@pulumi/pulumi"
import { join } from "path"

export const getStage = (): string => {
  const stackName = pulumi.getStack()
  const [stage] = stackName.split('.')
  return stage
}

function prefixName(name?: string) {
  const namePrefix = `${getStage()}-${pulumi.getProject()}`
  return name ? `${namePrefix}-${name}` : namePrefix
}

function relativeRootPath(path: string) {
  return join(process.cwd(), "..", path)
}

/**
 * Globals
 */
const account = pulumi.output(aws.getCallerIdentity({ async: true })).accountId
const executionRoleName = prefixName('role')
const processedBucketName = `nftcom-${getStage()}-assets-processed`
const assetBucketName = `nftcom-${getStage()}-assets`
const assetBucket = new aws.s3.Bucket(assetBucketName, {
  arn: `arn:aws:s3:::${assetBucketName}`,
  bucket: assetBucketName
},
{ protect: true })
const lambdaImageName = prefixName()
const lambdaFunctionName = prefixName()

/**
 * Bucket for Processed Images
 */
 const processedBucket = new aws.s3.Bucket(processedBucketName, {
  arn: `arn:aws:s3:::${processedBucketName}`,
  bucket: processedBucketName,
  corsRules: [{
      allowedHeaders: [
          "amz-sdk-invocation-id",
          "amz-sdk-request",
          "authorization",
          "Authorization",
          "content-type",
          "Content-Type",
          "Referer",
          "User-Agent",
          "x-amz-content-sha256",
          "x-amz-date",
          "x-amz-security-token",
          "x-amz-user-agent",
      ],
      allowedMethods: [
          "HEAD",
          "GET",
          "PUT",
      ],
      allowedOrigins: ["*"],
      maxAgeSeconds: 3000,
  }],
})

const bucketPolicy = new aws.s3.BucketPolicy("my-bucket-policy", {
  bucket: processedBucket.bucket,
  policy: processedBucket.bucket.apply(publicReadPolicyForBucket)
})

function publicReadPolicyForBucket(bucketName: string) {
  return JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
          Effect: "Allow",
          Principal: "*",
          Action: [
              "s3:GetObject"
          ],
          Resource: [
              `arn:aws:s3:::${bucketName}/*`
          ]
      }]
  });
}

/**
 * IAM Role
 */
const executionRole = new aws.iam.Role(executionRoleName, {
  name: executionRoleName,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com"
  }),
  tags: {
    Environment: getStage()
  }
})
const executionRolePolicyName = `${executionRoleName}-policy`
const rolePolicy = new aws.iam.RolePolicy(executionRolePolicyName, {
  name: executionRolePolicyName,
  role: executionRole,
  policy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: account.apply(
          (accountId) =>
            `arn:aws:logs:${aws.config.region}:${accountId}:log-group:/aws/lambda/${lambdaFunctionName}*`
        )
      },
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
        ],
        "Resource": pulumi.interpolate`${assetBucket.arn}/*`
      },
      {
        "Effect": "Allow",
        "Action": [
          "s3:PutObject"
        ],
        "Resource": pulumi.interpolate`${processedBucket.arn}/*`
      }
    ]
  }
})

/**
 * ECR Repo for image
 */
 const repository = new aws.ecr.Repository(lambdaImageName, {
  name: lambdaImageName,
  imageScanningConfiguration: {
    scanOnPush: true,
  },
})

export const repositoryUrl = repository.repositoryUrl

/**
 * Lambda Function
 */
const createLambdaFunction = new aws.lambda.Function(lambdaFunctionName, {
  name: lambdaFunctionName,
  imageUri: pulumi.interpolate`${repository.repositoryUrl}:latest`,
  packageType: 'Image',
  role: executionRole.arn,
  memorySize: 1024,
  timeout: 15,
  tags: {
    Environment: pulumi.getStack()
  }
})

/**
 * Bucket Trigger
 */
const allowBucket = new aws.lambda.Permission("allowBucket", {
  action: "lambda:InvokeFunction",
  function: createLambdaFunction.arn,
  principal: "s3.amazonaws.com",
  sourceArn: assetBucket.arn,
})
const bucketNotification = new aws.s3.BucketNotification("bucketNotification", {
  bucket: assetBucket.id,
  lambdaFunctions: [{
    lambdaFunctionArn: createLambdaFunction.arn,
    events: ["s3:ObjectCreated:*"],
  }],
}, {
  dependsOn: [allowBucket],
})