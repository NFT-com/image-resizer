FROM public.ecr.aws/lambda/nodejs:16

COPY ./build/functions/resize.js ${LAMBDA_TASK_ROOT}
COPY ./layers/node_modules ${LAMBDA_TASK_ROOT}

CMD [ "resize.handler" ]