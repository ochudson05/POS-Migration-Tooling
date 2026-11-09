FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m patchright install --with-deps chromium

COPY . .
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["python", "app.py"]
