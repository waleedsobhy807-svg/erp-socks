output "rds_endpoint" {
  description = "RDS PostgreSQL instance endpoint (host:port). Use as DB_HOST in Lambda environment variables."
  value       = aws_db_instance.main.endpoint
  sensitive   = false
}

output "rds_host" {
  description = "RDS PostgreSQL hostname only (without port)."
  value       = aws_db_instance.main.address
}

output "rds_port" {
  description = "RDS PostgreSQL port."
  value       = aws_db_instance.main.port
}

output "rds_db_name" {
  description = "Database name inside the RDS instance."
  value       = aws_db_instance.main.db_name
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID. Required by the Lambda auth middleware and the React frontend."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN."
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_web_client_id" {
  description = "Cognito App Client ID for the React/Amplify frontend."
  value       = aws_cognito_user_pool_client.web.id
}

output "api_gateway_url" {
  description = "Base URL of the HTTP API Gateway endpoint. Append /module/resource to build full URLs."
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_gateway_id" {
  description = "API Gateway HTTP API ID."
  value       = aws_apigatewayv2_api.main.id
}

output "s3_bucket_names" {
  description = "Map of logical bucket names (documents, reports, assets) to their S3 bucket names."
  value = {
    for key, bucket in aws_s3_bucket.buckets : key => bucket.bucket
  }
}

output "s3_bucket_arns" {
  description = "Map of logical bucket names to S3 bucket ARNs."
  value = {
    for key, bucket in aws_s3_bucket.buckets : key => bucket.arn
  }
}

output "lambda_execution_role_arn" {
  description = "IAM Role ARN to assign to Lambda functions as their execution role."
  value       = aws_iam_role.lambda_exec.arn
}

output "vpc_id" {
  description = "VPC ID. Required when configuring Lambda VPC settings."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs. Attach Lambda functions to these subnets for RDS access."
  value       = aws_subnet.private[*].id
}

output "lambda_security_group_id" {
  description = "Security group ID to attach to Lambda functions so they can reach RDS."
  value       = aws_security_group.lambda.id
}

output "amplify_app_id" {
  description = "Amplify application ID."
  value       = aws_amplify_app.frontend.id
}

output "amplify_default_domain" {
  description = "Default Amplify domain for the frontend application."
  value       = aws_amplify_app.frontend.default_domain
}
