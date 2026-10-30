# SockERP — Socks Manufacturing Enterprise Resource Planning

A cloud-native ERP system built for socks manufacturers on AWS, covering inventory, production, orders, procurement, quality control, HR, and financial reporting.

---

## Module List

| Module | Description |
|---|---|
| **Inventory** | Raw material stock, yarn types, finished goods tracking |
| **Production** | Work orders, knitting machine scheduling, shift management |
| **Orders** | Customer orders, B2B/B2C, fulfillment pipeline |
| **Procurement** | Supplier management, purchase orders, receiving |
| **Quality Control** | Defect tracking, batch inspection, reject/rework flows |
| **Shipping & Logistics** | Packaging, carrier integration, dispatch tracking |
| **HR & Payroll** | Employee records, shift hours, payroll runs |
| **Finance** | Cost of goods, invoicing, P&L reports, tax |
| **Reporting & Analytics** | Dashboards, PDF/CSV export, scheduled reports |
| **Admin** | User management, roles, audit log, config |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, AWS Amplify Hosting |
| **Auth** | AWS Cognito User Pool (email + optional MFA) |
| **API** | AWS API Gateway (HTTP API) |
| **Compute** | AWS Lambda (Node.js 20) |
| **Database** | AWS RDS PostgreSQL 15 (db.t3.medium) |
| **Storage** | AWS S3 (documents, reports, assets) |
| **IaC** | Terraform ≥ 1.5 |
| **CI/CD** | GitHub Actions + AWS Amplify CI |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AWS Cloud (VPC)                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     Public Subnet                            │   │
│  │  ┌──────────────┐    ┌──────────────────────────────────┐   │   │
│  │  │  API Gateway │───▶│  Lambda Functions (Node.js 20)   │   │   │
│  │  │  (HTTP API)  │    │  - inventory, orders, production  │   │   │
│  │  └──────────────┘    │  - procurement, hr, finance       │   │   │
│  │         ▲            └──────────────┬───────────────────┘   │   │
│  │         │                           │                        │   │
│  └─────────┼───────────────────────────┼────────────────────────┘   │
│            │                           │                             │
│  ┌─────────┼───────────────────────────┼────────────────────────┐   │
│  │         │        Private Subnet     │                        │   │
│  │         │                     ┌─────▼──────────────────┐    │   │
│  │         │                     │  RDS PostgreSQL 15      │    │   │
│  │         │                     │  (db.t3.medium)         │    │   │
│  │         │                     └────────────────────────┘    │   │
│  └─────────┼────────────────────────────────────────────────────┘   │
│            │                                                         │
│  ┌─────────┴────────────────────────────────────────────────────┐   │
│  │                        Global Services                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │   Cognito    │  │  S3 Buckets  │  │  Amplify Hosting  │   │   │
│  │  │  User Pool   │  │  documents   │  │  (React SPA)      │   │   │
│  │  │  (email+MFA) │  │  reports     │  │                   │   │   │
│  │  └──────────────┘  │  assets      │  └──────────────────┘   │   │
│  │                    └──────────────┘                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

Browser/Mobile ──▶ Amplify (HTTPS) ──▶ API Gateway ──▶ Lambda
                         │
                    Cognito Auth (JWT)
```

---

## Prerequisites

- AWS CLI ≥ 2.x configured with appropriate IAM permissions
- Terraform ≥ 1.5
- Node.js 20.x + npm 10.x
- GitHub repository (update `amplify_github_repo` variable)

---

## Setup Instructions

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd erp-socks
```

### 2. Infrastructure — Terraform

```bash
cd infrastructure/terraform

# Copy and edit the tfvars file
cp terraform.tfvars.example terraform.tfvars
# Edit: set db_password, aws_region, environment, github_repo

terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

After apply, note the outputs:
```bash
terraform output
```

### 3. Backend — Lambda functions

```bash
cd backend
npm ci

# Set environment variables (use AWS SSM or .env for local dev)
export DB_HOST=$(terraform -chdir=../infrastructure/terraform output -raw rds_endpoint)
export DB_NAME=erp_socks
export DB_USER=erp_admin
export DB_PASSWORD=<your-password>
export COGNITO_USER_POOL_ID=$(terraform -chdir=../infrastructure/terraform output -raw cognito_user_pool_id)
export AWS_REGION=us-east-1
```

### 4. Frontend — Amplify

Connect your GitHub repository to the Amplify app created by Terraform, or use the Amplify Console to trigger a manual deploy. The `amplify.yml` at the repo root configures the build.

---

## Environment Variables (Lambda)

| Variable | Description |
|---|---|
| `DB_HOST` | RDS endpoint |
| `DB_PORT` | PostgreSQL port (default 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password (use SSM Parameter Store in prod) |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `AWS_REGION` | AWS region |
| `ENVIRONMENT` | dev / staging / prod |

---

## Project Structure

```
erp-socks/
├── README.md
├── amplify.yml
├── .gitignore
├── infrastructure/
│   └── terraform/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── backend/
    ├── package.json
    └── src/
        ├── db/
        │   └── connection.js
        ├── middleware/
        │   └── auth.js
        └── utils/
            └── response.js
```
