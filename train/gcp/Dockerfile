FROM python:3.12-slim
WORKDIR /opt/aegis
COPY backend/requirements-train.txt .
RUN pip install --no-cache-dir -r requirements-train.txt
COPY backend/app ./app
ENV PYTHONPATH=/opt/aegis
ENV AEGIS_PLATFORM=gcp
ENV AEGIS_DATA=/tmp/aegis-out
CMD ["python", "-m", "app.train_job"]
