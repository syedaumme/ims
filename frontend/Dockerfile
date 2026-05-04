FROM nginx:alpine
# Copy your local build folder
COPY build /usr/share/nginx/html
# Copy the new config file you just made
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]