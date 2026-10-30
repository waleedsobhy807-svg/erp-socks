variable "aws_region" {
  description = "AWS region to deploy resources into"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must be a valid AWS region identifier, e.g. us-east-1."
  }
}

variable "environment" {
  description = "Deployment environment. Controls multi-AZ, deletion protection, and backup settings."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "db_password" {
  description = "Master password for the RDS PostgreSQL instance. Must be at least 16 characters. Store this in a secrets manager; never commit it to source control."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_password) >= 16
    error_message = "db_password must be at least 16 characters long."
  }
}

variable "amplify_github_repo" {
  description = "Full GitHub repository URL for the Amplify frontend, e.g. https://github.com/your-org/erp-socks-frontend. The Amplify app must be granted access to this repo via the Amplify Console after first apply."
  type        = string
  default     = "https://github.com/your-org/erp-socks-frontend"
}

variable "allowed_origins" {
  description = "List of allowed CORS origins for the API Gateway. Only used when environment = prod. In dev/staging, all origins (*) are allowed."
  type        = list(string)
  default     = ["https://main.your-amplify-domain.amplifyapp.com"]
}
