const rawAndaiUrl = process.env.REACT_APP_ANDAI_URL || '';

export const getAndaiAssistantUrl = (): string => {
  const baseUrl = rawAndaiUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return '';
  return `${baseUrl}/dashboard/assistant`;
};

export const openAndaiAssistant = (): void => {
  const url = getAndaiAssistantUrl();
  if (url) {
    window.location.href = url;
  }
};
