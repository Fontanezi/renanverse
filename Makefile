sp1:
	SUPERPEER_ID=1 PORT=4001 BASE_URL=http://localhost:4001 \
	SUPERPEERS=http://localhost:4002,http://localhost:4003 npm run dev:superpeer
sp2:
	SUPERPEER_ID=2 PORT=4002 BASE_URL=http://localhost:4002 \
	SUPERPEERS=http://localhost:4001,http://localhost:4003 npm run dev:superpeer
sp3:
	SUPERPEER_ID=3 PORT=4003 BASE_URL=http://localhost:4003 \
	SUPERPEERS=http://localhost:4001,http://localhost:4002 npm run dev:superpeer 
tw:
	SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:twitter& cd frontend/ && npm run dev:twitter
rd:
	SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:reddit& cd frontend/ && npm run dev:reddit
in:
	SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:instagram& cd frontend/ && npm run dev:instagram
