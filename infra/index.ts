import * as aws from "@pulumi/aws"
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
 * Code Archive & Lambda layer
 */
const code = new pulumi.asset.AssetArchive({
  ".": new pulumi.asset.FileArchive(relativeRootPath("build/archive.zip"))
})

const zipFile = relativeRootPath("layers/archive.zip")
const nodeModuleLambdaLayerName = prefixName("lambda-layer-nodemodules")
const nodeModuleLambdaLayer = new aws.lambda.LayerVersion(
  nodeModuleLambdaLayerName,
  {
    compatibleRuntimes: [aws.lambda.Runtime.NodeJS16dX],
    code: new pulumi.asset.FileArchive(zipFile),
    layerName: nodeModuleLambdaLayerName
  }
)

/**
 * Lambda Function
 */
const createLambdaFunction = new aws.lambda.Function(lambdaFunctionName, {
  name: lambdaFunctionName,
  runtime: aws.lambda.Runtime.NodeJS16dX,
  handler: "functions/resize.handler",
  role: executionRole.arn,
  code,
  layers: [nodeModuleLambdaLayer.arn],
  memorySize: 128,
  environment: {
    variables: {
      DYNAMODB_TABLE: "todosDynamoDbTableName"
    }
  },
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