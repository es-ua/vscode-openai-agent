  private async makeRequest(method: string, endpoint: string, data?: any, apiKey?: string): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: (method === 'POST' || method === 'PUT' || method === 'PATCH') ? data : undefined
      });
      
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${error.response.data?.error?.message || error.response.statusText}`);
      }
      throw error;
    }
  }
