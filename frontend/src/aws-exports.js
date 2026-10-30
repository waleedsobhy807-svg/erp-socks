const awsExports = {
  aws_project_region: process.env.REACT_APP_AWS_REGION,
  aws_cognito_region: process.env.REACT_APP_AWS_REGION,
  aws_user_pools_id: process.env.REACT_APP_COGNITO_USER_POOL_ID,
  aws_user_pools_web_client_id: process.env.REACT_APP_COGNITO_CLIENT_ID,
  API: {
    endpoints: [
      {
        name: "erp-api",
        endpoint: process.env.REACT_APP_API_URL
      }
    ]
  }
};

export default awsExports;
